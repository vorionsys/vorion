# MarketplaceListing

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Id** | Pointer to **string** |  | [optional] 
**AgentId** | Pointer to **string** |  | [optional] 
**TrainerId** | Pointer to **string** |  | [optional] 
**Title** | Pointer to **string** |  | [optional] 
**Description** | Pointer to **string** |  | [optional] 
**PriceType** | Pointer to **string** |  | [optional] 
**PriceAmount** | Pointer to **float32** |  | [optional] 
**CommissionRate** | Pointer to **float32** | Commission percentage (0-100) | [optional] 
**Status** | Pointer to **string** |  | [optional] 
**AvgRating** | Pointer to **float32** |  | [optional] 
**TotalAcquisitions** | Pointer to **int32** |  | [optional] 
**CreatedAt** | Pointer to **time.Time** |  | [optional] 

## Methods

### NewMarketplaceListing

`func NewMarketplaceListing() *MarketplaceListing`

NewMarketplaceListing instantiates a new MarketplaceListing object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewMarketplaceListingWithDefaults

`func NewMarketplaceListingWithDefaults() *MarketplaceListing`

NewMarketplaceListingWithDefaults instantiates a new MarketplaceListing object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetId

`func (o *MarketplaceListing) GetId() string`

GetId returns the Id field if non-nil, zero value otherwise.

### GetIdOk

`func (o *MarketplaceListing) GetIdOk() (*string, bool)`

GetIdOk returns a tuple with the Id field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetId

`func (o *MarketplaceListing) SetId(v string)`

SetId sets Id field to given value.

### HasId

`func (o *MarketplaceListing) HasId() bool`

HasId returns a boolean if a field has been set.

### GetAgentId

`func (o *MarketplaceListing) GetAgentId() string`

GetAgentId returns the AgentId field if non-nil, zero value otherwise.

### GetAgentIdOk

`func (o *MarketplaceListing) GetAgentIdOk() (*string, bool)`

GetAgentIdOk returns a tuple with the AgentId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetAgentId

`func (o *MarketplaceListing) SetAgentId(v string)`

SetAgentId sets AgentId field to given value.

### HasAgentId

`func (o *MarketplaceListing) HasAgentId() bool`

HasAgentId returns a boolean if a field has been set.

### GetTrainerId

`func (o *MarketplaceListing) GetTrainerId() string`

GetTrainerId returns the TrainerId field if non-nil, zero value otherwise.

### GetTrainerIdOk

`func (o *MarketplaceListing) GetTrainerIdOk() (*string, bool)`

GetTrainerIdOk returns a tuple with the TrainerId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTrainerId

`func (o *MarketplaceListing) SetTrainerId(v string)`

SetTrainerId sets TrainerId field to given value.

### HasTrainerId

`func (o *MarketplaceListing) HasTrainerId() bool`

HasTrainerId returns a boolean if a field has been set.

### GetTitle

`func (o *MarketplaceListing) GetTitle() string`

GetTitle returns the Title field if non-nil, zero value otherwise.

### GetTitleOk

`func (o *MarketplaceListing) GetTitleOk() (*string, bool)`

GetTitleOk returns a tuple with the Title field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTitle

`func (o *MarketplaceListing) SetTitle(v string)`

SetTitle sets Title field to given value.

### HasTitle

`func (o *MarketplaceListing) HasTitle() bool`

HasTitle returns a boolean if a field has been set.

### GetDescription

`func (o *MarketplaceListing) GetDescription() string`

GetDescription returns the Description field if non-nil, zero value otherwise.

### GetDescriptionOk

`func (o *MarketplaceListing) GetDescriptionOk() (*string, bool)`

GetDescriptionOk returns a tuple with the Description field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDescription

`func (o *MarketplaceListing) SetDescription(v string)`

SetDescription sets Description field to given value.

### HasDescription

`func (o *MarketplaceListing) HasDescription() bool`

HasDescription returns a boolean if a field has been set.

### GetPriceType

`func (o *MarketplaceListing) GetPriceType() string`

GetPriceType returns the PriceType field if non-nil, zero value otherwise.

### GetPriceTypeOk

`func (o *MarketplaceListing) GetPriceTypeOk() (*string, bool)`

GetPriceTypeOk returns a tuple with the PriceType field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPriceType

`func (o *MarketplaceListing) SetPriceType(v string)`

SetPriceType sets PriceType field to given value.

### HasPriceType

`func (o *MarketplaceListing) HasPriceType() bool`

HasPriceType returns a boolean if a field has been set.

### GetPriceAmount

`func (o *MarketplaceListing) GetPriceAmount() float32`

GetPriceAmount returns the PriceAmount field if non-nil, zero value otherwise.

### GetPriceAmountOk

`func (o *MarketplaceListing) GetPriceAmountOk() (*float32, bool)`

GetPriceAmountOk returns a tuple with the PriceAmount field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPriceAmount

`func (o *MarketplaceListing) SetPriceAmount(v float32)`

SetPriceAmount sets PriceAmount field to given value.

### HasPriceAmount

`func (o *MarketplaceListing) HasPriceAmount() bool`

HasPriceAmount returns a boolean if a field has been set.

### GetCommissionRate

`func (o *MarketplaceListing) GetCommissionRate() float32`

GetCommissionRate returns the CommissionRate field if non-nil, zero value otherwise.

### GetCommissionRateOk

`func (o *MarketplaceListing) GetCommissionRateOk() (*float32, bool)`

GetCommissionRateOk returns a tuple with the CommissionRate field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetCommissionRate

`func (o *MarketplaceListing) SetCommissionRate(v float32)`

SetCommissionRate sets CommissionRate field to given value.

### HasCommissionRate

`func (o *MarketplaceListing) HasCommissionRate() bool`

HasCommissionRate returns a boolean if a field has been set.

### GetStatus

`func (o *MarketplaceListing) GetStatus() string`

GetStatus returns the Status field if non-nil, zero value otherwise.

### GetStatusOk

`func (o *MarketplaceListing) GetStatusOk() (*string, bool)`

GetStatusOk returns a tuple with the Status field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetStatus

`func (o *MarketplaceListing) SetStatus(v string)`

SetStatus sets Status field to given value.

### HasStatus

`func (o *MarketplaceListing) HasStatus() bool`

HasStatus returns a boolean if a field has been set.

### GetAvgRating

`func (o *MarketplaceListing) GetAvgRating() float32`

GetAvgRating returns the AvgRating field if non-nil, zero value otherwise.

### GetAvgRatingOk

`func (o *MarketplaceListing) GetAvgRatingOk() (*float32, bool)`

GetAvgRatingOk returns a tuple with the AvgRating field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetAvgRating

`func (o *MarketplaceListing) SetAvgRating(v float32)`

SetAvgRating sets AvgRating field to given value.

### HasAvgRating

`func (o *MarketplaceListing) HasAvgRating() bool`

HasAvgRating returns a boolean if a field has been set.

### GetTotalAcquisitions

`func (o *MarketplaceListing) GetTotalAcquisitions() int32`

GetTotalAcquisitions returns the TotalAcquisitions field if non-nil, zero value otherwise.

### GetTotalAcquisitionsOk

`func (o *MarketplaceListing) GetTotalAcquisitionsOk() (*int32, bool)`

GetTotalAcquisitionsOk returns a tuple with the TotalAcquisitions field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTotalAcquisitions

`func (o *MarketplaceListing) SetTotalAcquisitions(v int32)`

SetTotalAcquisitions sets TotalAcquisitions field to given value.

### HasTotalAcquisitions

`func (o *MarketplaceListing) HasTotalAcquisitions() bool`

HasTotalAcquisitions returns a boolean if a field has been set.

### GetCreatedAt

`func (o *MarketplaceListing) GetCreatedAt() time.Time`

GetCreatedAt returns the CreatedAt field if non-nil, zero value otherwise.

### GetCreatedAtOk

`func (o *MarketplaceListing) GetCreatedAtOk() (*time.Time, bool)`

GetCreatedAtOk returns a tuple with the CreatedAt field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetCreatedAt

`func (o *MarketplaceListing) SetCreatedAt(v time.Time)`

SetCreatedAt sets CreatedAt field to given value.

### HasCreatedAt

`func (o *MarketplaceListing) HasCreatedAt() bool`

HasCreatedAt returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


