# CreateWebhook201Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**data** | [**Webhook**](Webhook.md) |  | [optional] 

## Example

```python
from agentanchor.models.create_webhook201_response import CreateWebhook201Response

# TODO update the JSON string below
json = "{}"
# create an instance of CreateWebhook201Response from a JSON string
create_webhook201_response_instance = CreateWebhook201Response.from_json(json)
# print the JSON string representation of the object
print(CreateWebhook201Response.to_json())

# convert the object into a dict
create_webhook201_response_dict = create_webhook201_response_instance.to_dict()
# create an instance of CreateWebhook201Response from a dict
create_webhook201_response_from_dict = CreateWebhook201Response.from_dict(create_webhook201_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


