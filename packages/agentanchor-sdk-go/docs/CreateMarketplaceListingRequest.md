# CreateMarketplaceListingRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**AgentId** | **string** |  | 
**Title** | **string** |  | 
**Description** | Pointer to **string** |  | [optional] 
**PriceType** | **string** |  | 
**PriceAmount** | Pointer to **float32** |  | [optional] 
**CommissionRate** | Pointer to **float32** |  | [optional] 

## Methods

### NewCreateMarketplaceListingRequest

`func NewCreateMarketplaceListingRequest(agentId string, title string, priceType string, ) *CreateMarketplaceListingRequest`

NewCreateMarketplaceListingRequest instantiates a new CreateMarketplaceListingRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewCreateMarketplaceListingRequestWithDefaults

`func NewCreateMarketplaceListingRequestWithDefaults() *CreateMarketplaceListingRequest`

NewCreateMarketplaceListingRequestWithDefaults instantiates a new CreateMarketplaceListingRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetAgentId

`func (o *CreateMarketplaceListingRequest) GetAgentId() string`

GetAgentId returns the AgentId field if non-nil, zero value otherwise.

### GetAgentIdOk

`func (o *CreateMarketplaceListingRequest) GetAgentIdOk() (*string, bool)`

GetAgentIdOk returns a tuple with the AgentId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetAgentId

`func (o *CreateMarketplaceListingRequest) SetAgentId(v string)`

SetAgentId sets AgentId field to given value.


### GetTitle

`func (o *CreateMarketplaceListingRequest) GetTitle() string`

GetTitle returns the Title field if non-nil, zero value otherwise.

### GetTitleOk

`func (o *CreateMarketplaceListingRequest) GetTitleOk() (*string, bool)`

GetTitleOk returns a tuple with the Title field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTitle

`func (o *CreateMarketplaceListingRequest) SetTitle(v string)`

SetTitle sets Title field to given value.


### GetDescription

`func (o *CreateMarketplaceListingRequest) GetDescription() string`

GetDescription returns the Description field if non-nil, zero value otherwise.

### GetDescriptionOk

`func (o *CreateMarketplaceListingRequest) GetDescriptionOk() (*string, bool)`

GetDescriptionOk returns a tuple with the Description field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDescription

`func (o *CreateMarketplaceListingRequest) SetDescription(v string)`

SetDescription sets Description field to given value.

### HasDescription

`func (o *CreateMarketplaceListingRequest) HasDescription() bool`

HasDescription returns a boolean if a field has been set.

### GetPriceType

`func (o *CreateMarketplaceListingRequest) GetPriceType() string`

GetPriceType returns the PriceType field if non-nil, zero value otherwise.

### GetPriceTypeOk

`func (o *CreateMarketplaceListingRequest) GetPriceTypeOk() (*string, bool)`

GetPriceTypeOk returns a tuple with the PriceType field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPriceType

`func (o *CreateMarketplaceListingRequest) SetPriceType(v string)`

SetPriceType sets PriceType field to given value.


### GetPriceAmount

`func (o *CreateMarketplaceListingRequest) GetPriceAmount() float32`

GetPriceAmount returns the PriceAmount field if non-nil, zero value otherwise.

### GetPriceAmountOk

`func (o *CreateMarketplaceListingRequest) GetPriceAmountOk() (*float32, bool)`

GetPriceAmountOk returns a tuple with the PriceAmount field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPriceAmount

`func (o *CreateMarketplaceListingRequest) SetPriceAmount(v float32)`

SetPriceAmount sets PriceAmount field to given value.

### HasPriceAmount

`func (o *CreateMarketplaceListingRequest) HasPriceAmount() bool`

HasPriceAmount returns a boolean if a field has been set.

### GetCommissionRate

`func (o *CreateMarketplaceListingRequest) GetCommissionRate() float32`

GetCommissionRate returns the CommissionRate field if non-nil, zero value otherwise.

### GetCommissionRateOk

`func (o *CreateMarketplaceListingRequest) GetCommissionRateOk() (*float32, bool)`

GetCommissionRateOk returns a tuple with the CommissionRate field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetCommissionRate

`func (o *CreateMarketplaceListingRequest) SetCommissionRate(v float32)`

SetCommissionRate sets CommissionRate field to given value.

### HasCommissionRate

`func (o *CreateMarketplaceListingRequest) HasCommissionRate() bool`

HasCommissionRate returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


